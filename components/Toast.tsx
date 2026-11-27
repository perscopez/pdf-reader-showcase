'use client'

import { useEffect, useState } from 'react'

export interface ToastMessage {
  id: number
  text: string
  type: 'success' | 'error' | 'info'
  action?: { label: string; onClick: () => void }
}

interface ToastProps {
  messages: ToastMessage[]
  onRemove: (id: number) => void
}

export function ToastContainer({ messages, onRemove }: ToastProps) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 items-center pointer-events-none">
      {messages.map(m => (
        <ToastItem key={m.id} message={m} onRemove={onRemove} />
      ))}
    </div>
  )
}

function ToastItem({ message, onRemove }: { message: ToastMessage; onRemove: (id: number) => void }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Fade in
    const t1 = setTimeout(() => setVisible(true), 10)
    // Fade out then remove
    const t2 = setTimeout(() => setVisible(false), message.action ? 5200 : 2200)
    const t3 = setTimeout(() => onRemove(message.id), message.action ? 5500 : 2500)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [message.id, onRemove])

  const bg = message.type === 'error'
    ? 'bg-red-600'
    : message.type === 'info'
    ? 'bg-blue-600'
    : 'bg-emerald-600'

  return (
    <div className={`${bg} text-white text-sm font-medium px-5 py-2.5 rounded-full shadow-xl transition-all duration-300 pointer-events-auto
      ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
      {message.text}
      {message.action && (
        <button type="button" onClick={() => { message.action?.onClick(); onRemove(message.id) }} className="ml-3 rounded-md border border-white/40 px-2 py-0.5 text-xs font-bold hover:bg-white/15">
          {message.action.label}
        </button>
      )}
    </div>
  )
}

// Hook for using toasts
import { useCallback, useRef } from 'react'

export function useToast() {
  const [messages, setMessages] = useState<ToastMessage[]>([])
  const counter = useRef(0)

  const toast = useCallback((text: string, type: ToastMessage['type'] = 'success', action?: ToastMessage['action']) => {
    const id = ++counter.current
    setMessages(prev => [...prev, { id, text, type, action }])
  }, [])

  const remove = useCallback((id: number) => {
    setMessages(prev => prev.filter(m => m.id !== id))
  }, [])

  return { messages, toast, remove }
}
