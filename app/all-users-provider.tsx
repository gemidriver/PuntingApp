import React, { useState, useEffect } from 'react';
import AllUsersContext from './all-users-context';
import type { ProfileRecord } from './types';
import { getSupabaseClient } from '../lib/supabase';

export const AllUsersProvider = ({ children }: { children: React.ReactNode }) => {
  const [allUsers, setAllUsers] = useState<Record<string, ProfileRecord>>({});

  useEffect(() => {
    async function fetchUsers() {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.from('profiles').select('id, email, username, is_admin');
      if (!error && Array.isArray(data)) {
        const users: Record<string, ProfileRecord> = {};
        data.forEach((u: any) => {
          users[u.username] = {
            id: u.id,
            email: u.email,
            username: u.username,
            isAdmin: u.is_admin,
          };
        });
        setAllUsers(users);
      }
    }
    fetchUsers();
  }, []);

  return (
    <AllUsersContext.Provider value={allUsers}>
      {children}
    </AllUsersContext.Provider>
  );
};
