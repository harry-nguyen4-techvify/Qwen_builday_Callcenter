/** Material Symbols Outlined wrapper */
export default function Icon({
  name,
  fill,
  className = '',
  size,
}: {
  name: string
  fill?: boolean
  className?: string
  size?: number
}) {
  return (
    <span
      className={`material-symbols-outlined ${className}`}
      style={{
        fontVariationSettings: `'FILL' ${fill ? 1 : 0}`,
        ...(size ? { fontSize: size } : {}),
      }}
    >
      {name}
    </span>
  )
}
