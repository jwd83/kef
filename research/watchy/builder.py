import shutil
import os
import sys
import json
import subprocess


def main():
    # check for uncommitted changes and bail if any
    status_result = subprocess.run(['git', 'status', '--porcelain'], capture_output=True, text=True)
    if status_result.stdout.strip():
        print("Uncommitted changes detected. Please commit or stash them before building.")
        return

    print("Working tree is clean.")

    # change version?
    ver = change_version()

    # Default flow: do NOT build installers locally. Instead, push a git tag
    # (v<version>) to trigger GitHub Actions, which will build and attach the
    # installers to the GitHub Release.
    # Default to **no** for local installer builds; CI builds are the primary path.
    build_local = input("Build installers locally on this machine? (y/N): ").strip().lower()
    if build_local == 'y':
        clean_dist_folder()
        build()

        # Optional: upload locally built artifacts (legacy flow)
        release_to_github(ver)

    trigger_ci = input(f"Create and push git tag v{ver} to trigger GitHub Actions build? (Y/n): ").strip().lower()
    if trigger_ci in ('', 'y'):
        create_and_push_tag(ver)
        print(f"Pushed tag v{ver}. GitHub Actions should build and upload installers shortly.")
    else:
        print("Skipping tag push.")


def release_to_github(version: str):
    """Legacy: Upload locally-built artifacts in dist/release to a GitHub release using the gh CLI."""
    release = input("Upload *local* artifacts in dist/release to GitHub? (y/n): ").strip().lower()
    if release != 'y':
        print("Skipping GitHub upload.")
        return

    tag = f"v{version}"
    release_dir = os.path.join('dist', 'release')

    if not os.path.isdir(release_dir):
        print(f"No '{release_dir}' directory found, nothing to release.")
        return

    # Only pick artifacts that contain the version in their filename so we
    # don't accidentally push artifacts from other versions.
    artifacts = []
    for fname in os.listdir(release_dir):
        full_path = os.path.join(release_dir, fname)
        if os.path.isfile(full_path) and version in fname:
            artifacts.append(full_path)

    if not artifacts:
        print(f"No artifacts in '{release_dir}' for version {version}, aborting release.")
        return

    print(f"Preparing to publish {len(artifacts)} artifact(s) for tag {tag}:")
    for a in artifacts:
        print(f"  - {a}")

    # Check whether the release already exists.
    print(f"Checking if GitHub release {tag} exists...")
    view_result = subprocess.run([
        'gh', 'release', 'view', tag
    ])

    if view_result.returncode == 0:
        # Release exists: upload and clobber matching assets.
        print(f"Release {tag} exists. Uploading assets with --clobber...")
        cmd = ['gh', 'release', 'upload', tag, '--clobber', *artifacts]
    else:
        # Release does not exist: create it with these assets.
        print(f"Release {tag} does not exist. Creating new release...")
        title = f"watchy {version}"
        notes = f"Automated release for version {version}."
        cmd = ['gh', 'release', 'create', tag, *artifacts,
               '--title', title,
               '--notes', notes]

    result = subprocess.run(cmd)
    if result.returncode == 0:
        print(f"GitHub release {tag} published successfully.")
    else:
        print(f"Failed to publish GitHub release {tag}. gh exited with {result.returncode}.")

def change_version():
    # display current version in package.json
    with open('package.json', 'r') as f:
        package_data = json.load(f)
    current_version = package_data.get('version', '0.0.0')
    print(f"Current version: {current_version}")

    if input("Change version? (y/n): ").strip().lower() != 'y':
        return current_version

    new_version = input("Enter new version (e.g., 1.2.3): ").strip()
    if not new_version:
        print("No version entered; keeping current version.")
        return current_version

    # Let npm update package.json + package-lock.json in a canonical way.
    # --no-git-tag-version: builder.py controls tagging separately.
    print(f"Running: npm version {new_version} --no-git-tag-version")

    # NOTE: On Windows, npm is a .cmd file, so we need shell=True to locate it.
    # On Unix, npm is typically a direct executable.
    try:
        subprocess.run(
            ['npm', 'version', new_version, '--no-git-tag-version'],
            capture_output=True,
            text=True,
            check=True,
            shell=sys.platform == 'win32',
        )
    except subprocess.CalledProcessError as e:
        print(f"npm version failed (exit {e.returncode}); aborting version change.")
        if e.stdout:
            print(e.stdout.rstrip())
        if e.stderr:
            print(e.stderr.rstrip())
        return current_version

    print("Committing version change to git...")
    to_add = ['package.json']
    if os.path.exists('package-lock.json'):
        to_add.append('package-lock.json')
    subprocess.run(['git', 'add', *to_add])
    subprocess.run(['git', 'commit', '-m', f'{new_version}'])
    subprocess.run(['git', 'push'])

    return new_version


def build():
    if sys.platform == 'win32':
        build_windows()
    elif sys.platform == 'darwin':
        build_macos()
    elif sys.platform.startswith('linux'):
        build_linux()
    else:
        print(f"Unsupported platform for local installer build: {sys.platform}")

def clean_dist_folder():
    """Always start from a clean dist/ tree before building locally."""

    # Clean dist/ (this also cleans dist/release)
    if os.path.exists('dist'):
        shutil.rmtree('dist')
        print("dist/ folder removed.")
    else:
        print("dist/ folder does not exist, nothing to clean.")
    os.makedirs('dist', exist_ok=True)
    print("dist/ folder created.")


def create_and_push_tag(version: str, remote: str = 'origin'):
    """Create an annotated git tag v<version> and push it.

    This is the primary mechanism to trigger GitHub Actions builds.
    """
    tag = f"v{version}"

    # bail if tag already exists locally
    exists = subprocess.run(['git', 'rev-parse', '-q', '--verify', f"refs/tags/{tag}"])
    if exists.returncode == 0:
        print(f"Tag {tag} already exists. Aborting.")
        return

    print(f"Creating tag {tag}...")
    create = subprocess.run(['git', 'tag', '-a', tag, '-m', tag])
    if create.returncode != 0:
        print(f"Failed to create tag {tag}.")
        return

    print(f"Pushing tag {tag} to {remote}...")
    push = subprocess.run(['git', 'push', remote, tag])
    if push.returncode != 0:
        print(f"Failed to push tag {tag}.")
        return

def build_macos():
    print("Building for macOS...")
    os.system('npm run build:mac')

    release_dir = os.path.join('dist', 'release')
    os.makedirs(release_dir, exist_ok=True)

    # copy the built .dmg to dist/release/
    dist_files = os.listdir('dist')
    for file in dist_files:
        if file.endswith('.dmg'):
            shutil.copy(os.path.join('dist', file), release_dir)
            print(f"Copied {file} to {release_dir}/")





def build_windows():
    print("Building for Windows...")
    os.system('npm run build:win')

    release_dir = os.path.join('dist', 'release')
    os.makedirs(release_dir, exist_ok=True)

    # copy the built .exe to dist/release/
    dist_files = os.listdir('dist')
    for file in dist_files:
        if file.endswith('.exe'):
            shutil.copy(os.path.join('dist', file), release_dir)
            print(f"Copied {file} to {release_dir}/")


def build_linux():
    print("Building for Linux...")
    os.system('npm run build:linux')

    release_dir = os.path.join('dist', 'release')
    os.makedirs(release_dir, exist_ok=True)

    # copy the built Linux artifacts to dist/release/
    dist_files = os.listdir('dist')
    for file in dist_files:
        if file.endswith('.AppImage'):
            shutil.copy(os.path.join('dist', file), release_dir)
            print(f"Copied {file} to {release_dir}/")

if __name__ == "__main__":
    main()