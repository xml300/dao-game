import os

def generate_directory_structure(startpath, exclude_dirs=None):
    """
    Generates a string representation of the directory structure,
    excluding specified directories.
    """
    if exclude_dirs is None:
        exclude_dirs = []

    output = f"Directory structure:\n"

    # Handle the root directory separately to match the output format's first line
    if os.path.isdir(startpath):
        output += f"└── {os.path.basename(os.path.abspath(startpath))}/\n"
        prefix = " " * 4 # Prefix for items directly inside the root

        try:
            items = sorted([item for item in os.listdir(startpath) if item not in exclude_dirs])
            for i, item in enumerate(items):
                path = os.path.join(startpath, item)
                is_last = (i == len(items) - 1)
                output += _generate_item_structure(path, prefix, is_last, exclude_dirs)
        except OSError:
             output += f"{prefix}    [Error accessing directory]\n"


    return output

def _generate_item_structure(path, prefix, is_last, exclude_dirs):
    """Recursively generates structure for an item (file or directory)."""
    output = ""
    pointer = "└── " if is_last else "├── "
    item_name = os.path.basename(path)

    if os.path.isdir(path):
        # Skip if the directory is in the exclude list
        if item_name in exclude_dirs:
            return ""

        output += f"{prefix}{pointer}{item_name}/\n"
        next_prefix = prefix + ("    " if is_last else "│   ")
        try:
            items = sorted([item for item in os.listdir(path) if item not in exclude_dirs])
            for i, item in enumerate(items):
                item_path = os.path.join(path, item)
                is_last_item = (i == len(items) - 1)
                output += _generate_item_structure(item_path, next_prefix, is_last_item, exclude_dirs)
        except OSError:
            # Handle permission errors or other OS-related issues
            output += f"{next_prefix}    [Error accessing directory]\n"
    else:
        output += f"{prefix}{pointer}{item_name}\n"

    return output

# Example usage: Replace '.' with the path to your desired directory
# and provide a list of directory names to exclude
directory_path = '.'
exclude_folders = ['__pycache__', 'node_modules', '.git'] # Add folder names to exclude here
print(generate_directory_structure(directory_path, exclude_folders))