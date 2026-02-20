import { Select } from "@base-ui/react/select"
import { supportedLngs } from "~/lib/i18n"
import styles from "./LanguageSelect.module.css"

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
      <Select.Trigger className={styles.trigger}>
        <Select.Value />
        <Select.Icon className={styles.icon}>&#9662;</Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner side="bottom" alignment="start" sideOffset={4}>
          <Select.Popup className={styles.popup}>
            {supportedLngs.map((lng) => (
              <Select.Item key={lng} value={lng} className={styles.item}>
                <Select.ItemText>{languageNames[lng] ?? lng}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  )
}
