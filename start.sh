#!/bin/bash
set -e

# Default source database in the container image
SOURCE_DB="/app/mining.db"

# Check if we are using a custom DB path (mounted volume)
if [ -n "$MINING_DB_PATH" ]; then
    echo "Configuration detected: Custom DB Path -> $MINING_DB_PATH"
    
    # Safety Check: Is it a directory?
    if [ -d "$MINING_DB_PATH" ]; then
        echo "CRITICAL ERROR: $MINING_DB_PATH is a directory, but the application expects a file."
        echo "This usually happens if Docker created the volume path as a directory before the file existed."
        echo "FIX: Please delete the directory '$MINING_DB_PATH' (or the corresponding folder on your host) and restart."
        
        # Check if the file is inside?
        if [ -f "$MINING_DB_PATH/mining.db" ]; then
             echo "Found mining.db inside the directory. Updating config to use that..."
             export MINING_DB_PATH="$MINING_DB_PATH/mining.db"
        else
             exit 1
        fi
    fi

    # Check if the target file exists
    if [ ! -f "$MINING_DB_PATH" ]; then
        echo "Notice: Database not found at $MINING_DB_PATH"
        echo "Action: Populating new volume with default data from $SOURCE_DB..."
        
        # Ensure the directory exists
        mkdir -p "$(dirname "$MINING_DB_PATH")"
        
        # Copy the file
        if [ -f "$SOURCE_DB" ]; then
            cp "$SOURCE_DB" "$MINING_DB_PATH"
            echo "Success: Database initialized in volume."
        else
            echo "Error: Source database $SOURCE_DB not found in container!"
        fi
    else
        echo "Success: Found existing database in volume. Using it."
    fi
    
    # FIX: Ensure we have permissions to read/write the DB and the directory (for lock files)
    echo "Fixing permissions for $MINING_DB_PATH..."
    
    # Try to take ownership
    chown $(id -u):$(id -g) "$MINING_DB_PATH" || echo "Warning: Could not chown DB file"
    chown $(id -u):$(id -g) "$(dirname "$MINING_DB_PATH")" || echo "Warning: Could not chown DB dir"

    chmod 666 "$MINING_DB_PATH" || echo "Warning: Could not chmod DB file"
    chmod -R 777 "$(dirname "$MINING_DB_PATH")" || echo "Warning: Could not chmod DB directory"
    
    echo " Debug: Permissions check:"
    ls -la "$MINING_DB_PATH"
    ls -ld "$(dirname "$MINING_DB_PATH")"
fi

# Execute the main application command
echo "Starting services..."
exec npx concurrently --kill-others "npx vite --host" "cd .. && python backend/main.py"
