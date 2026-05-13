import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_BASE = process.env.BACKEND_INTERNAL_URL || "http://localhost:8000";

function buildTarget(path: string[], search: string): string {
  const joined = path.join("/");
  return `${BACKEND_BASE}/${joined}${search}`;
}

function copySafeHeaders(src: Headers): Headers {
  const out = new Headers();
  src.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === "host" || k === "content-length" || k === "connection" || k === "content-encoding") {
      return;
    }
    out.set(key, value);
  });
  return out;
}

async function forward(req: NextRequest, path: string[]) {
  try {
    const url = new URL(req.url);
    const target = buildTarget(path, url.search);

    const headers = copySafeHeaders(req.headers);
    const contentType = req.headers.get("content-type") || "";
    let body: BodyInit | undefined;

    if (req.method !== "GET" && req.method !== "HEAD") {
      if (contentType.includes("multipart/form-data")) {
        body = await req.formData();
        headers.delete("content-type");
      } else if (contentType.includes("application/json")) {
        body = JSON.stringify(await req.json());
        headers.set("content-type", "application/json");
      } else {
        body = await req.text();
      }
    }

    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      cache: "no-store",
    });

    const resHeaders = copySafeHeaders(upstream.headers);
    const contentTypeOut = upstream.headers.get("content-type") || "";

    if (contentTypeOut.includes("application/json")) {
      const data = await upstream.json();
      return NextResponse.json(data, { status: upstream.status, headers: resHeaders });
    }

    const text = await upstream.text();
    return new NextResponse(text, { status: upstream.status, headers: resHeaders });
  } catch (error) {
    return NextResponse.json(
      {
        detail: "Proxy request failed",
        error: error instanceof Error ? error.message : "unknown error",
      },
      { status: 502 }
    );
  }
}

export async function GET(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return forward(req, path);
}

export async function POST(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return forward(req, path);
}

export async function PUT(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return forward(req, path);
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return forward(req, path);
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return forward(req, path);
}
