import { NextResponse } from 'next/server';
import registry from '@/data/templates.json';

export function GET() {
  return NextResponse.json(registry);
}
