## Git Tag & Release Management

The GitHub Actions CI automatically builds multi-platform packages and publishes a GitHub Release whenever a new tag matching `v*.*.*` is pushed.

### 1. Create and Push a New Tag (Release)

Use the `./bump-version.sh` script to automatically bump the version and synchronize all project files:

```bash
# Auto-bump patch version from the latest tag (e.g. v1.0.5 -> v1.0.6):
./bump-version.sh

# Or specify an explicit version:
./bump-version.sh [new version]
# For example:
./bump-version.sh 1.0.6

# Commit the version changes and create the tag:
git commit -am "release: v1.0.6"
git tag v1.0.6

# Push code and tag to GitHub to trigger CI release build:
git push origin main
git push origin v1.0.6
```

### 2. Delete a Tag

When you need to delete an incorrect or broken tag:

- **Delete local tag:**
  ```bash
  git tag -d v1.0.6
  ```
- **Delete remote tag on GitHub:**
  ```bash
  git push origin --delete v1.0.6
  ```
- *(Optional)* If GitHub already created a Release for that tag, go to **Releases** on GitHub and click **Delete release**.

### 3. Overwrite / Force Update a Tag

When you need to update an existing tag to point to a newer commit without changing the version number:

```bash
# 1. Update the local tag to point to the current commit (using -f / --force):
git tag -f v1.0.6

# 2. Force-push the updated tag to GitHub:
git push origin -f v1.0.6
```
