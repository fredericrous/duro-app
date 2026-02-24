import { Select } from "@fredericrous/duro-design-system"
import { supportedLngs } from "~/lib/i18n"

const languageNames: Record<string, string> = {
  en: "English",
  fr: "Francais",
}

interface LanguageSelectProps {
  name?: string
  defaultValue?: string
}

export function LanguageSelect({ name = "locale", defaultValue = "en" }: LanguageSelectProps) {
  return (
    <Select.Root name={name} defaultValue={defaultValue}>
      <Select.Trigger>
        <Select.Value placeholder="Language" />
        <Select.Icon />
      </Select.Trigger>
      <Select.Popup>
        {supportedLngs.map((lng) => (
          <Select.Item key={lng} value={lng}>
            <Select.ItemText>{languageNames[lng] ?? lng}</Select.ItemText>
          </Select.Item>
        ))}
      </Select.Popup>
    </Select.Root>
  )
}
