#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <netinet/in.h>
#include <sys/socket.h>
#define sceHttpSetAutoRedirect sceHttpSetAutoRedirect_stub
#define sceHttpSetRecvTimeOut sceHttpSetRecvTimeOut_stub
#define sceHttpSetResponseHeaderMaxSize sceHttpSetResponseHeaderMaxSize_stub
#include <orbis/Http.h>
#undef sceHttpSetAutoRedirect
#undef sceHttpSetRecvTimeOut
#undef sceHttpSetResponseHeaderMaxSize
#include <orbis/Ssl.h>
#include "dislike_cache.h"

extern "C" {
    int32_t sceHttpSetRecvTimeOut(int32_t id, uint32_t usec);
}

extern int32_t g_http_ctx_id;
extern int32_t g_ssl_ctx_id;

static int ssl_callback_ryd(int, unsigned int, void* const[], int, void*) {
    return 1;
}

static DislikeCacheEntry g_cache[DISLIKE_CACHE_SIZE];
static int g_cache_count = 0;

static DislikeData* cache_lookup(const char* video_id) {
    for (int i = 0; i < g_cache_count; i++) {
        if (strncmp(g_cache[i].video_id, video_id, 15) == 0)
            return &g_cache[i].data;
    }
    return nullptr;
}

static void cache_insert(const char* video_id, const DislikeData* data) {
    int slot = g_cache_count < DISLIKE_CACHE_SIZE
        ? g_cache_count++
        : (g_cache_count % DISLIKE_CACHE_SIZE);
    strncpy(g_cache[slot].video_id, video_id, 15);
    g_cache[slot].video_id[15] = '\0';
    g_cache[slot].data = *data;
}

static long long parse_json_ll(const char* json, const char* key) {
    char search[64];
    snprintf(search, sizeof(search), "\"%s\":", key);
    const char* p = strstr(json, search);
    if (!p) return -1;
    p += strlen(search);
    while (*p == ' ') p++;
    return atoll(p);
}

bool ryd_fetch(const char* video_id, DislikeData* out) {
    DislikeData* hit = cache_lookup(video_id);
    if (hit) {
        *out = *hit;
        return true;
    }

    char url[128];
    snprintf(url, sizeof(url),
        "https://returnyoutubedislikeapi.com/votes?videoId=%s", video_id);

    int32_t tmpl = sceHttpCreateTemplate(g_http_ctx_id, "RYD-PS4/1.0", 1, 0);
    if (tmpl < 0) return false;

    sceHttpsSetSslCallback(tmpl, ssl_callback_ryd, nullptr);
    sceHttpSetRecvTimeOut(tmpl, 2 * 1000 * 1000);

    int32_t conn = sceHttpCreateConnectionWithURL(tmpl, url, 0);
    if (conn < 0) { sceHttpDeleteTemplate(tmpl); return false; }

    int32_t req = sceHttpCreateRequestWithURL(conn, 0, url, 0);
    if (req < 0) {
        sceHttpDeleteConnection(conn);
        sceHttpDeleteTemplate(tmpl);
        return false;
    }

    bool ok = false;
    if (sceHttpSendRequest(req, nullptr, 0) >= 0) {
        int32_t status = 0;
        sceHttpGetStatusCode(req, &status);
        if (status == 200) {
            char buf[512] = {};
            int32_t n = sceHttpReadData(req, buf, sizeof(buf) - 1);
            if (n > 0) {
                long long l = parse_json_ll(buf, "likes");
                long long d = parse_json_ll(buf, "dislikes");
                if (l >= 0 && d >= 0) {
                    out->likes    = l;
                    out->dislikes = d;
                    cache_insert(video_id, out);
                    ok = true;
                }
            }
        }
    }

    sceHttpDeleteRequest(req);
    sceHttpDeleteConnection(conn);
    sceHttpDeleteTemplate(tmpl);
    return ok;
}

void ryd_format_count(long long n, char* buf, int bufsz) {
    if (n >= 1000000)
        snprintf(buf, bufsz, "%.1fM", n / 1000000.0);
    else if (n >= 1000)
        snprintf(buf, bufsz, "%.1fK", n / 1000.0);
    else
        snprintf(buf, bufsz, "%lld", n);
}
