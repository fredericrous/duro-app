export function loader() {
  return Response.json(
    { status: "ok" },
    {
      headers: {
        "Access-Control-Allow-Origin": "https://join.daddyshome.fr",
      },
    },
  );
}
