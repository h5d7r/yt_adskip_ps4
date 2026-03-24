#pragma once
#include <stdint.h>

#define DISLIKE_CACHE_SIZE 32

struct DislikeData {
    long long likes;
    long long dislikes;
};

struct DislikeCacheEntry {
    char video_id[16];
    DislikeData data;
};

bool ryd_fetch(const char* video_id, DislikeData* out);
void ryd_format_count(long long n, char* buf, int bufsz);
