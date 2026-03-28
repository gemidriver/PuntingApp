import { createContext } from "react";
import type { ProfileRecord } from "./types";

// Context to provide all users for chat @mention autocomplete
const AllUsersContext = createContext<Record<string, ProfileRecord> | null>(null);
export default AllUsersContext;
