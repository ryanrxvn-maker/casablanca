// Stub do createClient do servidor: o "usuário logado" é o que o teste põe em globalThis.__user.
export function createClient() {
  const g = globalThis as unknown as { __user: { id: string; email: string } | null };
  return {
    auth: { getUser: async () => ({ data: { user: g.__user ?? null } }) },
  } as never;
}
