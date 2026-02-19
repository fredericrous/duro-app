interface IconProps {
  svg: string
  size?: number
  className?: string
}

export function Icon({ svg, size = 24, className }: IconProps) {
  return <div className={className} style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />
}
