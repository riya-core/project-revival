import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";

// Sends the signed-in user's access token with every server-function call so
// requireSupabaseAuth can verify who is calling.
export const attachSupabaseAuth = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return next(token ? { headers: { Authorization: `Bearer ${token}` } } : {});
});
