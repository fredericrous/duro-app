interface IconProps {
  svg: string
  size?: number
  className?: string
}

export function Icon({ svg, size = 24, className }: IconProps) {
  // App icons arrive as raw SVG markup from the app catalog and are injected
  // verbatim; react-strict-dom has no dangerouslySetInnerHTML escape hatch.
  // eslint-disable-next-line duro/no-raw-html-element -- raw SVG markup from the catalog needs dangerouslySetInnerHTML, which the design-system Box lacks
  return <div className={className} style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />
}
