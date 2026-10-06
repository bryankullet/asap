import type { ReactNode } from "react";
type Vals = Record<string, unknown>;
export function renderSpace(v: Vals): ReactNode;
export function renderConversation(v: Vals): ReactNode;
export function renderToast(v: Vals): ReactNode;
export function renderSheet(v: Vals): ReactNode;
