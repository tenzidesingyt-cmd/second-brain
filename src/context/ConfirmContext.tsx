import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { Modal } from '../components/Modal'

interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn>(async () => false)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const [resolver, setResolver] = useState<((value: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((nextOptions) => {
    return new Promise<boolean>((resolve) => {
      setOptions(nextOptions)
      setResolver(() => resolve)
    })
  }, [])

  const close = (value: boolean) => {
    resolver?.(value)
    setResolver(null)
    setOptions(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={Boolean(options)}
        onClose={() => close(false)}
        title={options?.title}
        size="sm"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => close(false)}>
              {options?.cancelLabel || 'Отмена'}
            </button>
            <button
              className={options?.danger ? 'btn btn-danger' : 'btn btn-primary'}
              onClick={() => close(true)}
              data-autofocus
            >
              {options?.confirmLabel || 'Удалить'}
            </button>
          </>
        }
      >
        <p className="confirm-description">
          {options?.description || 'Это действие нельзя отменить.'}
        </p>
      </Modal>
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  return useContext(ConfirmContext)
}
