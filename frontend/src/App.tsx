import { useEffect, useRef, useState } from 'react'
import './App.css'

type Message = { role: 'user' | 'assistant'; text: string }
type Status = 'idle' | 'thinking' | 'speaking'

const WS = 'clever-heart-production-ab45.up.railway.app'

export default function App() {
  const [messages, setMessages] = useState<Message[]>([])
  const [status, setStatus]     = useState<Status>('idle')
  const [streamText, setStreamText] = useState('')
  const [llmMs, setLlmMs]       = useState(0)
  const [input, setInput]       = useState('')

  const wsRef     = useRef<WebSocket | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamText])

  useEffect(() => {
    const ws = new WebSocket(WS)
    wsRef.current = ws

    ws.onopen = () => console.log('WS connected')

    ws.onmessage = async (e) => {
      const msg = JSON.parse(e.data)

      if (msg.type === 'thinking') {
        setStatus('thinking')
        setStreamText('')
      }
      if (msg.type === 'token') {
        setStreamText(p => p + msg.text)
      }
      if (msg.type === 'done') {
        setLlmMs(msg.llmLatency)
        setStreamText('')
        setMessages(p => [...p, { role: 'assistant', text: msg.text }])
        speak(msg.text)
      }
      if (msg.type === 'error') {
        setStatus('idle')
      }
    }

    return () => ws.close()
  }, [])

  const speak = (text: string) => {
    setStatus('speaking')
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'en-IN'
    u.rate = 1.0
    u.onend = () => setStatus('idle')
    u.onerror = () => setStatus('idle')
    window.speechSynthesis.speak(u)
  }

  const sendMessage = () => {
    if (!input.trim() || status !== 'idle') return
    setMessages(p => [...p, { role: 'user', text: input }])
    wsRef.current?.send(JSON.stringify({ type: 'chat', text: input }))
    setInput('')
  }

  const statusText: Record<Status, string> = {
    idle:     'Ask me anything',
    thinking: 'Thinking…',
    speaking: 'Speaking…'
  }

  return (
    <div className="app">
      <header>
        <h1>Arya</h1>
        <p className="subtitle">AI Banking Assistant</p>
        {llmMs > 0 && (
          <p className="latency">LLM {llmMs}ms</p>
        )}
      </header>

      <div className="messages">
        {messages.length === 0 && (
          <div className="empty">
            Ask me anything — EMIs, loan eligibility, interest rates…
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <span className="who">{m.role === 'user' ? 'You' : 'Arya'}</span>
            <p>{m.text}</p>
          </div>
        ))}
        {streamText && (
          <div className="msg assistant">
            <span className="who">Arya</span>
            <p>{streamText}<span className="cursor" /></p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="controls">
        <p className="status-label">{statusText[status]}</p>
        <div className="input-row">
          <input
            className="chat-input"
            placeholder="Type your question…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendMessage()}
            disabled={status !== 'idle'}
          />
          <button
            className="send-btn"
            onClick={sendMessage}
            disabled={status !== 'idle'}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}