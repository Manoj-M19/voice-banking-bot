import express from 'express'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import cors from 'cors'
import dotenv from 'dotenv'
import OpenAI from 'openai'
import multer from 'multer'

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json())

const upload = multer({ storage: multer.memoryStorage() })
const server = createServer(app)
const wss = new WebSocketServer({ server })

const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY!,
  baseURL: 'https://api.groq.com/openai/v1'
})


const SYSTEM_PROMPT = `You are Arya, a friendly Indian banking voice assistant.
Help users with:
- EMI calculations: EMI = P x r x (1+r)^n / ((1+r)^n - 1) where r = monthly rate
- Loan eligibility: max loan = 60x monthly salary rule
- Interest rates: home loan 8.5-9.5%, personal 12-18%, car 9-11%
- General banking questions
Rules:
- Keep responses under 3 sentences (will be spoken aloud)
- Be warm and concise
- For EMIs always clearly state the final monthly amount in rupees`

app.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    const audioBuffer = req.file!.buffer
    const t0 = Date.now()

    const response = await fetch(
      'https://api.deepgram.com/v1/listen?model=nova-2&language=en-IN&smart_format=true',
      {
        method: 'POST',
        headers: {
          'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`,
          'Content-Type': 'audio/webm'
        },
        body: audioBuffer as unknown as BodyInit
      }
    )

    const data = await response.json() as any
    const transcript = data?.results?.channels[0]?.alternatives[0]?.transcript || ''
    const sttLatency = Date.now() - t0

    res.json({ transcript, sttLatency })
  } catch (err) {
    console.error('STT error:', err)
    res.status(500).json({ error: 'Transcription failed' })
  }
})


type Session = { history: { role: 'user' | 'assistant'; content: string }[] }
const sessions = new Map<WebSocket, Session>()

wss.on('connection', (ws: WebSocket) => {
  console.log('Client connected')
  sessions.set(ws, { history: [] })

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString())
      const session = sessions.get(ws)!

      if (msg.type === 'chat') {
        const { text } = msg
        session.history.push({ role: 'user', content: text })
        ws.send(JSON.stringify({ type: 'thinking' }))

        const t0 = Date.now()
        const stream = await openai.chat.completions.create({
          model: 'llama-3.1-8b-instant',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...session.history
          ],
          stream: true,
          max_tokens: 120
        })

        let full = ''
        for await (const chunk of stream) {
          const token = chunk.choices[0]?.delta?.content || ''
          if (token) {
            full += token
            ws.send(JSON.stringify({ type: 'token', text: token }))
          }
        }

        session.history.push({ role: 'assistant', content: full })
        ws.send(JSON.stringify({
          type: 'done',
          text: full,
          llmLatency: Date.now() - t0
        }))
      }
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: 'Something went wrong' }))
    }
  })

  ws.on('close', () => {
    sessions.delete(ws)
    console.log('Client disconnected')
  })
})

app.get('/health', (_, res) => res.json({ status: 'ok' }))

const PORT = process.env.PORT || 3001
server.listen(PORT, () =>
  console.log(`Backend running on http://localhost:${PORT}`)
)