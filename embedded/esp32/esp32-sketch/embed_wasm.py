Import("env")
import os

# Get the project directory
project_dir = env.subst("$PROJECT_DIR")

# Path to the WASM file
wasm_file = os.path.join(project_dir, "pigeonhub_client.wasm")

# Check if file exists
if os.path.exists(wasm_file):
    print(f"Embedding WASM binary: {wasm_file}")
    # Add linker flags to embed the binary
    env.Append(
        LINKFLAGS=[
            "-Wl,--embedded-file",
            f"-Wl,{wasm_file}"
        ]
    )
    # Alternative method using objcopy
    env.Append(
        BUILD_FLAGS=[
            f'-DWASM_BINARY_PATH=\\"{wasm_file}\\"'
        ]
    )
else:
    print(f"WARNING: WASM file not found at {wasm_file}")
    print("PigeonHub will compile but WASM functionality will not work!")
