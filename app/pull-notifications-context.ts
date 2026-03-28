import { createContext } from 'react';

// Default to a no-op function
const PullNotificationsContext = createContext<() => void>(() => {});
export default PullNotificationsContext;
