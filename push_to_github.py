"""
Script to push all project files to GitHub repository using GitHub Git Data REST API.
Reads GITHUB_TOKEN from environment or input.
"""

import os
import base64
import httpx

GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
REPO_OWNER = "godtoe-max"
REPO_NAME = "disneywaittimes"
BRANCH = "main"

BASE_URL = f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}"

IGNORE_DIRS = {".git", "__pycache__", "venv", ".venv", "env", ".idea", ".vscode"}
IGNORE_FILES = {"disney_wait_times.db", "wait_times.db", "wait_times.db-wal", "wait_times.db-shm"}

def get_all_files(root_dir):
    file_paths = []
    for root, dirs, files in os.walk(root_dir):
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
        for f in files:
            if f.endswith((".pyc", ".db", ".log")) or f in IGNORE_FILES:
                continue
            full_path = os.path.join(root, f)
            rel_path = os.path.relpath(full_path, root_dir).replace("\\", "/")
            file_paths.append((rel_path, full_path))
    return file_paths

def push_repo(token: str):
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "DisneyWaitTimes-Pusher"
    }
    client = httpx.Client(headers=headers, timeout=60.0)
    root_dir = os.path.dirname(__file__)

    print(f"Checking repository state for {REPO_OWNER}/{REPO_NAME}...")
    ref_res = client.get(f"{BASE_URL}/git/ref/heads/{BRANCH}")
    if ref_res.status_code != 200:
        print(f"Branch '{BRANCH}' not found or repo is empty.")
        return

    parent_commit_sha = ref_res.json()["object"]["sha"]
    print(f"Parent commit on '{BRANCH}' is {parent_commit_sha[:7]}")

    files_to_push = get_all_files(root_dir)
    print(f"Found {len(files_to_push)} files to commit and push.")

    tree_items = []
    for rel_path, full_path in files_to_push:
        with open(full_path, "rb") as f:
            content_bytes = f.read()

        try:
            content_str = content_bytes.decode("utf-8")
            blob_payload = {"content": content_str, "encoding": "utf-8"}
        except UnicodeDecodeError:
            blob_payload = {"content": base64.b64encode(content_bytes).decode("ascii"), "encoding": "base64"}

        blob_res = client.post(f"{BASE_URL}/git/blobs", json=blob_payload)
        if blob_res.status_code not in (200, 201):
            print(f"Skipping/Failed blob for {rel_path}: {blob_res.text}")
            continue
        sha = blob_res.json()["sha"]
        tree_items.append({
            "path": rel_path,
            "mode": "100644",
            "type": "blob",
            "sha": sha
        })
        print(f"  + {rel_path}")

    tree_payload = {"tree": tree_items}
    tree_res = client.post(f"{BASE_URL}/git/trees", json=tree_payload)
    if tree_res.status_code not in (200, 201):
        raise RuntimeError(f"Failed to create tree: {tree_res.text}")
    new_tree_sha = tree_res.json()["sha"]

    commit_payload = {
        "message": "Update Disney Wait Times Tracker with full repository files",
        "tree": new_tree_sha,
        "parents": [parent_commit_sha]
    }
    commit_res = client.post(f"{BASE_URL}/git/commits", json=commit_payload)
    if commit_res.status_code not in (200, 201):
        raise RuntimeError(f"Failed to create commit: {commit_res.text}")
    new_commit_sha = commit_res.json()["sha"]

    update_ref_res = client.patch(f"{BASE_URL}/git/refs/heads/{BRANCH}", json={"sha": new_commit_sha, "force": True})
    if update_ref_res.status_code != 200:
        raise RuntimeError(f"Failed to update ref: {update_ref_res.text}")
    
    print(f"\nSUCCESS! Updated https://github.com/{REPO_OWNER}/{REPO_NAME}")

if __name__ == "__main__":
    t = GITHUB_TOKEN or input("GitHub Token: ").strip()
    if t:
        push_repo(t)
