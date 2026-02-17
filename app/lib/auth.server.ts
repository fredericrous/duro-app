// Trust boundary: Remote-User/Remote-Groups headers are set by Authelia forward-auth
// via Envoy Gateway SecurityPolicy. Direct pod access is prevented by Istio ambient mTLS.
// The public invite routes (join.daddyshome.fr) do NOT use these headers — they are
// authenticated via invite token only. The /welcome route is behind Authelia on
// home.daddyshome.fr, so headers there are trustworthy.

export interface AuthInfo {
  user: string | null;
  groups: string[];
}

export function parseAuthHeaders(request: Request): AuthInfo {
  const user = request.headers.get("Remote-User");
  const groupsHeader = request.headers.get("Remote-Groups");

  const groups = groupsHeader
    ? groupsHeader.split(",").map((g) => g.trim()).filter(Boolean)
    : [];

  return { user, groups };
}
