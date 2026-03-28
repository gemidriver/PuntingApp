
import { useEffect, useState } from "react";
import { getSupabaseClient } from "./supabase";

export function useUser() {
  const [user, setUser] = useState<any>(null);
  const [username, setUsername] = useState("");
  const [userId, setUserId] = useState("");

  useEffect(() => {
    const supabase = getSupabaseClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) {
        setUser(data.user);
        setUserId(data.user.id);
        const metaUsername = data.user.user_metadata?.username;
        if (metaUsername) {
          setUsername(metaUsername);
        } else {
          supabase
            .from("profiles")
            .select("username")
            .eq("id", data.user.id)
            .single()
            .then(({ data }) => {
              if (data?.username) setUsername(data.username);
            });
        }
      }
    });
  }, []);

  return { user, username, userId };
}
