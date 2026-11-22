// The fixture page's brain for Eris in a console (PG-90): brain.ask's answers by the tool asked
// for, as the browser stub's core streams them (packages/runtime/src/bridge/core.ts `ask`). A
// sentence about removing rows gets a write, any other a read; explanations are fixed sentences.
// Fixture data only; nothing needs Node.

/** The tool's arguments for a prompt, as the scripted brain calls the tool. */
export function assistAnswer(prompt: string, tool: string): Record<string, unknown> | undefined {
  if (tool === "propose_sql")
    return /remove|delete/iu.test(prompt)
      ? {
          statement: "delete from people where id not in (select person from orders)",
          explanation: "Deletes the people who have no orders.",
        }
      : {
          statement:
            "select p.name, count(o.id) from people p left join orders o on o.person = p.id group by p.name",
          explanation: "Counts each person's orders, people without any included.",
        };
  if (tool === "fix_sql_error")
    return { statement: "select 1/1", explanation: "Dividing by zero fails; divide by one." };
  if (tool === "explain_sql") return { explanation: "Reads every person, in no set order." };
  if (tool === "explain_sql_plan")
    return {
      explanation: "The join reads every order.",
      suggestion: "create index on orders (person)",
    };
  return undefined;
}
