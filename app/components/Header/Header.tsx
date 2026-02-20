import { useEffect, useRef, useState } from "react"
import { Link } from "react-router"
import { useTranslation } from "react-i18next"
import styles from "./Header.module.css"

interface HeaderProps {
  user: string
  isAdmin: boolean
}

export function Header({ user, isAdmin }: HeaderProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open])

  return (
    <header className={styles.header}>
      <Link to="/" className={styles.title}>
        {t("common.appTitle")}
      </Link>
      <div className={styles.menu} ref={ref}>
        <button className={styles.trigger} onClick={() => setOpen((v) => !v)}>
          {t("header.welcome", { user })} <span className={styles.caret}>&#9662;</span>
        </button>
        {open && (
          <div className={styles.dropdown}>
            {isAdmin && (
              <Link to="/admin" className={styles.dropdownItem} onClick={() => setOpen(false)}>
                {t("common.admin")}
              </Link>
            )}
            <Link to="/settings" className={styles.dropdownItem} onClick={() => setOpen(false)}>
              {t("common.settings")}
            </Link>
            <Link to="/auth/logout" className={styles.dropdownItem} onClick={() => setOpen(false)}>
              {t("common.logout")}
            </Link>
          </div>
        )}
      </div>
    </header>
  )
}
