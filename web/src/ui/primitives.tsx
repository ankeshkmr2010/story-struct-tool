import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { t } from '../i18n'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({ variant = 'secondary', size = 'md', className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return <button type={type} className={`ui-btn ui-btn-${variant}${size === 'sm' ? ' ui-btn-sm' : ''} ${className}`} {...props} />
}

export function IconButton({ label, className = '', ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & { label: string }) {
  return <button type="button" aria-label={label} title={label} className={`ui-icon-btn ${className}`} {...props} />
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`ui-card ${className}`}>{children}</div>
}

export function EmptyState({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return <div className="ui-empty"><p className="ui-empty-title">{title}</p>{children && <p>{children}</p>}{action}</div>
}

// In-page confirmation: never a blocking browser dialog.
export function ConfirmInline({ message, confirmLabel, onConfirm, onCancel, cancelLabel = t('Cancel'), danger = false }: { message: ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void; cancelLabel?: string; danger?: boolean }) {
  return <span role="group" aria-label={t('Confirm')} className="ui-confirm">
    <span>{message}</span>
    <Button size="sm" variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
    <Button size="sm" variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
  </span>
}
