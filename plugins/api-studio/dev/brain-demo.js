// Canned answers for the preview's screenshots (?brain=demo): the desk's brain answers these for
// real; here the tool's arguments are written out by hand.
export const DEMO_ANSWERS = {
  api_studio_answer: {
    reply:
      "**One test fails because the page holds an inactive user.** `Dara Novak` has `active: false`, and the test expects every user on the page to be active.\n\nIf inactive users are expected in this list, check for them instead of failing; if not, filter them out on the server with `?active=true`.",
    actions: [
      {
        kind: "add_tests",
        title: "Test that inactive users are marked, not missing",
        code: 'test("inactive users are marked", () => {\n  const inactive = res.body.data.filter((u) => !u.active);\n  for (const u of inactive) expect(u).to.have.property("role");\n});',
      },
      {
        kind: "add_checks",
        title: "Check the page size and the total",
        checks: [
          { target: "res.body.data", op: "length", value: "{{pageSize}}" },
          { target: "res.body.total", op: "gt", value: "0" },
        ],
      },
      {
        kind: "create_request",
        title: "Only active users",
        request: {
          name: "List active users",
          method: "GET",
          url: "{{baseUrl}}/users?active=true&limit={{pageSize}}",
        },
      },
    ],
  },
};
