import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { AdminUsersResult } from "~/lib/mutations/admin-users"

export function useAdminUsersMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (formData: FormData) =>
      fetch("/admin/users", { method: "POST", body: formData }).then((r) => r.json() as Promise<AdminUsersResult>),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
  })
}
