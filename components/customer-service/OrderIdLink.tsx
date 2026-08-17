'use client'

type Props = {
  orderId?: string | number | null
  orderName?: string | null
  className?: string
  /** Override destination (default: /orders/{id}) */
  href?: string | null
  title?: string
}

export function OrderIdLink({ orderId, orderName, className, href: hrefProp, title }: Props) {
  const id = orderId != null && String(orderId).trim() ? String(orderId).trim() : ''
  const label = orderName || (id ? `#${id}` : '—')
  if (!id && !hrefProp) {
    return <span className={className}>{label}</span>
  }

  const href = hrefProp || `/orders/${id}`

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className={`text-purple-600 hover:underline underline-offset-2 ${className || ''}`}
      title={title || 'Open full order details in a new tab'}
    >
      {label}
    </a>
  )
}
