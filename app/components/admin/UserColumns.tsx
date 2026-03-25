import { createColumnHelper } from "@tanstack/react-table"
import { Badge, Checkbox } from "@duro-app/ui"
import type { UserCertificate } from "~/lib/services/CertificateRepo.server"

export type UserData = {
  id: string
  displayName: string
  email: string
  creationDate: string
  certs: UserCertificate[]
  isSystem: boolean
  hasActiveCerts: boolean
  activeCertCount: number
}

export interface RevokeTarget {
  id: string
  email: string
  displayName: string
}

const columnHelper = createColumnHelper<UserData>()

export function buildColumns(t: (key: string, opts?: Record<string, unknown>) => string) {
  return [
    columnHelper.display({
      id: "select",
      size: 40,
      enableSorting: false,
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          onChange={table.getToggleAllPageRowsSelectedHandler()}
          aria-label={t("admin.users.selectAll")}
        />
      ),
      cell: ({ row }) => {
        if (!row.getCanSelect()) return null
        return (
          <Checkbox
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            aria-label={row.original.id}
          />
        )
      },
    }),
    columnHelper.accessor("id", {
      header: t("admin.users.cols.username"),
      size: 200,
      enableColumnFilter: true,
      enableSorting: true,
      cell: ({ row }) => {
        const { id, activeCertCount, certs } = row.original
        return (
          <>
            {id}
            {certs.length > 0 && (
              <>
                {" "}
                <Badge variant={activeCertCount > 0 ? "success" : "default"}>
                  {t("admin.users.certs.count", { count: activeCertCount })}
                </Badge>
              </>
            )}
          </>
        )
      },
    }),
    columnHelper.accessor("displayName", {
      header: t("admin.users.cols.displayName"),
      enableColumnFilter: true,
      enableSorting: true,
    }),
    columnHelper.accessor("email", {
      header: t("admin.users.cols.email"),
      size: 200,
      enableColumnFilter: true,
      enableSorting: true,
    }),
    columnHelper.accessor("creationDate", {
      header: t("admin.users.cols.created"),
      size: 120,
      enableSorting: true,
      enableColumnFilter: false,
      cell: ({ getValue }) => new Date(getValue()).toLocaleDateString(),
    }),
    columnHelper.display({
      id: "actions",
      header: t("admin.users.cols.actions"),
      enableSorting: false,
      // Cell rendering is handled by ActionCell component in the table body
      // to allow proper useFetcher hook usage per row
      cell: () => null,
    }),
  ]
}
