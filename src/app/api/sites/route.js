// src/app/api/sites/route.js
import { NextResponse } from 'next/server';
import { getScanEntries } from '../../../lib/scanMetadata';

export async function GET() {
    const sites = getScanEntries();
    return NextResponse.json(sites, { status: 200 });
}
