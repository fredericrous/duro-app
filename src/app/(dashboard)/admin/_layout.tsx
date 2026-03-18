import { Slot, usePathname, useRouter } from "expo-router"
import { css, html } from "react-strict-dom"
import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import { PageShell, Tabs } from "@duro-app/ui"
import { Header } from "~/components/Header/Header"
import { useMediaQuery } from "~/hooks/useMediaQuery"
import { spacing } from "@duro-app/tokens/tokens/spacing.css"

interface AdminMeData {
  user: string
  isAdmin: boolean
}

const styles = css.create({
  content: {
    paddingTop: spacing.md,
  },
  contentVertical: {
    paddingTop: 0,
    paddingLeft: spacing.md,
    flex: 1,
    minWidth: 0,
  },
})

export default function AdminLayout() {
  const { t } = useTranslation()
  const router = useRouter()
  const pathname = usePathname()
  const isWide = useMediaQuery("(min-width: 768px)")

  const activeTab = pathname === "/admin/users" ? "users" : "invites"

  const { data } = useQuery<AdminMeData>({
    queryKey: ["admin-me"],
    queryFn: () => fetch("/admin/me").then((r) => r.json()),
  })

  return (
    <PageShell maxWidth="lg" header={<Header user={data?.user ?? ""} isAdmin={data?.isAdmin ?? false} />}>
      <Tabs.Root
        value={activeTab}
        onValueChange={(value) => {
          router.push(value === "users" ? "/admin/users" : "/admin")
        }}
        orientation={isWide ? "vertical" : "horizontal"}
      >
        <Tabs.List>
          <Tabs.Tab value="invites">{t("admin.tabs.invites", "Invites")}</Tabs.Tab>
          <Tabs.Tab value="users">{t("admin.tabs.users", "Users")}</Tabs.Tab>
        </Tabs.List>
        <html.div style={[styles.content, isWide && styles.contentVertical]}>
          <Slot />
        </html.div>
      </Tabs.Root>
    </PageShell>
  )
}
