FROM postgres:15

LABEL maintainer="Danny Atalla"
LABEL description="Source-built PostGIS for Mining Map Platform (AMD64/ARM64)"

# 1. Install build dependencies and mathematical libraries
# postgresql-server-dev-15 provides postgres.h (required for libpgcommon)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    git \
    autoconf \
    automake \
    libtool \
    pkg-config \
    postgresql-server-dev-15 \
    libpcre2-dev \
    libxml2-dev \
    libgeos-dev \
    libproj-dev \
    libgdal-dev \
    libjson-c-dev \
    libprotobuf-c-dev \
    protobuf-c-compiler \
    && rm -rf /var/lib/apt/lists/*

# 2. Clone PostGIS source from GitHub
# We use the latest stable version (or you can specify a branch)
RUN git clone --depth 1 https://github.com/postgis/postgis.git /usr/src/postgis

# 3. Build and Install
WORKDIR /usr/src/postgis
RUN ./autogen.sh && \
    ./configure && \
    make -j$(nproc) && \
    make install

# 4. Cleanup
WORKDIR /
RUN rm -rf /usr/src/postgis && \
    apt-get purge -y --auto-remove build-essential git autoconf automake libtool pkg-config

# PostGIS is now compiled and installed in the system paths
