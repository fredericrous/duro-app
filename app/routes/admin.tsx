import { Outlet, useLocation, useNavigate, useRouteLoaderData } from "react-router"
import { css, html } from "react-strict-dom"
import { useTranslation } from "react-i18next"
import type { Route } from "./+types/admin"
import { getAuth } from "~/lib/auth.server"
import { config } from "~/lib/config.server"
import { PageShell, Tabs } from "@duro-app/ui"
import { Header } from "~/components/Header/Header"
import { useMediaQuery } from "~/hooks/useMediaQuery"
import { spacing } from "@duro-app/tokens/tokens/spacing.css"

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

export function meta() {
  return [{ title: "Admin - Duro" }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await getAuth(request)
  if (!auth.groups.includes(config.adminGroupName)) {
    throw new Response("Forbidden", { status: 403 })
  }
  return {}
}

export default function AdminLayout() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const isWide = useMediaQuery("(min-width: 768px)")
  const dashboardData = useRouteLoaderData("routes/dashboard") as {
    user: string
    isAdmin: boolean
  }

  const activeTab = location.pathname === "/admin/users" ? "users" : "invites"

  return (
    <PageShell
      maxWidth="lg"
      header={<Header user={dashboardData?.user ?? ""} isAdmin={dashboardData?.isAdmin ?? false} />}
    >
      <Tabs.Root
        value={activeTab}
        onValueChange={(value) => {
          navigate(value === "users" ? "/admin/users" : "/admin")
        }}
        orientation={isWide ? "vertical" : "horizontal"}
      >
        <Tabs.List>
          <Tabs.Tab value="invites">{t("admin.tabs.invites", "Invites")}</Tabs.Tab>
          <Tabs.Tab value="users">{t("admin.tabs.users", "Users")}</Tabs.Tab>
        </Tabs.List>
        <html.div style={[styles.content, isWide && styles.contentVertical]}>
          <Outlet />
        </html.div>
      </Tabs.Root>
    </PageShell>
  )
}
