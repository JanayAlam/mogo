import { NextResponse } from 'next/server'

export const fail = (status: number, detail: string) => NextResponse.json({ detail }, { status })
export const notFound = (what: string) => fail(404, `${what} not found`)
export const readJson = (req: Request): Promise<unknown> => req.json().catch(() => null)

export type IdParams = { params: Promise<{ id: string }> }
