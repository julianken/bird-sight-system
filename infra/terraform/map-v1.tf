# ── Tile-serving infrastructure for MapLibre basemap ────────────────────
#
# Self-hosted PMTiles on Cloudflare R2, served via a lightweight Worker.
# Mirrors the frontend.tf pattern (DNS + service resource in one file).
# See docs/plans/2026-04-22-plan-7-map-v1.md §Architecture.

resource "cloudflare_r2_bucket" "pmtiles" {
  account_id = var.cloudflare_account_id
  name       = "birdwatch-pmtiles"
  location   = "WNAM" # Western North America — closest to AZ users
}

resource "cloudflare_workers_script" "map_server" {
  account_id = var.cloudflare_account_id
  name       = "birdwatch-map-server"
  module     = true

  content = <<-EOT
    export default {
      async fetch(request, env) {
        const url = new URL(request.url);

        // CORS preflight
        if (request.method === "OPTIONS") {
          return new Response(null, {
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET, OPTIONS",
              "Access-Control-Allow-Headers": "Range",
              "Access-Control-Max-Age": "86400",
            },
          });
        }

        // Serve PMTiles file (the single .pmtiles archive) for range requests,
        // or individual pre-extracted .pbf tiles from R2.
        const key = url.pathname.replace(/^\//, "");
        const object = await env.TILES.get(key);

        if (!object) {
          return new Response("Not Found", { status: 404 });
        }

        return new Response(object.body, {
          headers: {
            "Content-Type": "application/vnd.mapbox-vector-tile",
            "Cache-Control": "public, max-age=31536000, immutable",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "Content-Length, Content-Range",
          },
        });
      },
    };
  EOT

  r2_bucket_binding {
    name        = "TILES"
    bucket_name = cloudflare_r2_bucket.pmtiles.name
  }
}

resource "cloudflare_workers_route" "map_tiles" {
  zone_id     = var.cloudflare_zone_id
  pattern     = "tiles.${var.domain}/*"
  script_name = cloudflare_workers_script.map_server.name
}

# tiles.bird-maps.com CNAME — Worker-routed hostname needs Cloudflare proxy
# (proxied = true) so the Worker route fires. Unlike the api subdomain which
# points to Cloud Run and must NOT be proxied.
resource "cloudflare_record" "tiles" {
  zone_id = var.cloudflare_zone_id
  name    = "tiles"
  type    = "CNAME"
  content = var.domain
  proxied = true
  ttl     = 1
}
