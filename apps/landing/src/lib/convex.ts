// Convex client for presence, the call and storage URLs (docs/frontend-guide.md §5 Convex tables).
import { ConvexClient } from 'convex/browser';
export { api } from '../../../../convex/_generated/api';

export const CONVEX_URL = import.meta.env.VITE_CONVEX_URL ?? 'https://hushed-shrimp-24.convex.cloud';
export const convex = new ConvexClient(CONVEX_URL);
