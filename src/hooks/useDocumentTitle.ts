import { useEffect } from 'react'

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Второй мозг` : 'Второй мозг'
  }, [title])
}
