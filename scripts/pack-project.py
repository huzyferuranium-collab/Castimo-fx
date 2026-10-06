import os
import zipfile

def create_zip():
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    public_dir = os.path.join(project_root, 'public')
    os.makedirs(public_dir, exist_ok=True)
    zip_path = os.path.join(public_dir, 'castimo-fx-project.zip')

    exclude_dirs = {'.git', 'node_modules', 'dist', '.cache', '.temp'}
    exclude_files = {'.DS_Store'}

    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(project_root):
            dirs[:] = [d for d in dirs if d not in exclude_dirs]
            for file in files:
                if file in exclude_files or file == 'castimo-fx-project.zip':
                    continue
                full_path = os.path.join(root, file)
                arcname = os.path.relpath(full_path, project_root)
                zipf.write(full_path, arcname)

    size_kb = round(os.path.getsize(zip_path) / 1024, 1)
    print(f"Project packaged into: {zip_path} ({size_kb} KB)")

if __name__ == '__main__':
    create_zip()
