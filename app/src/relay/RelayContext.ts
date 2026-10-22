import { createContext } from 'react';
import { RelayClient } from './RelayClient';

/** The TV's one relay connection, shared by the app and the player. */
export const RelayContext = createContext<RelayClient | null>(null);
