interface IconProps {
  svg: string
  size?: number
  className?: string
}

export function Icon({ svg, size = 24, className }: IconProps) {
  // App icons arrive as raw SVG markup from the app catalog and are injected
  // verbatim; react-strict-dom has no dangerouslySetInnerHTML escape hatch.
  // eslint-disable-next-line duro/no-raw-html-element
  return <div className={className} style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />
}
