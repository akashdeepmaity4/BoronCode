import html
import re

TEXT_EXTENSIONS = {
    'txt', 
    'md', 
    'js', 
    'ts', 
    'html', 
    'css', 
    'json', 
    'yaml', 
    'yml', 
    'py', 
    'c', 
    'cpp', 
    'java', 
    'sh',
    'csv',
    'tsv'
}

INDENT_RULES = {
    
    'html': 2,
    'htm': 2,
    'css': 2, 
    'json': 2, 
    'yaml': 2, 
    'yml': 2, 
    'js': 2, 
    'ts': 2,
    'py': 4, 
    'c': 4, 
    'cpp': 4, 
    'java': 4, 
    'sh': 4, 
    'txt': 4, 
    'md': 4,
    'csv': 4,
    'tsv': 4

}

def format_code(content: str, extension: str) -> str:
    ext = extension.lower().lstrip('.')
    if ext not in TEXT_EXTENSIONS:
        return content

    indent_size = INDENT_RULES.get(ext, 4)

    content = content.replace('\r\n', '\n').replace('\r', '\n')

    content = content.replace('\t', ' ' * indent_size)

    escaped_content = html.escape(content)
    lines = escaped_content.split('\n')
    formatted_lines = []

    for line in lines:
        match = re.match(r'^( +)', line)
        if match:
            num_spaces = len(match.group(1))
            line = ('&nbsp;' * num_spaces) + line[num_spaces:]
        
        line = line.replace('  ', '&nbsp;&nbsp;')
        formatted_lines.append(line)

    return '<br>'.join(formatted_lines)

def clean_html_to_raw_text(html_content: str) -> str:
    if not html_content:
        return ""

    text = html_content
    text = re.sub(r'<div>\s*<br\s*/?>\s*</div>', '\n', text, flags=re.IGNORECASE)

    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'<div>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</div>', '', text, flags=re.IGNORECASE)
    text = re.sub(r'<p[^>]*>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</p>', '', text, flags=re.IGNORECASE)

    text = re.sub(r'<[^>]+>', '', text)

    text = text.replace('&nbsp;', ' ')
    text = html.unescape(text)

    text = text.replace('\r\n', '\n').replace('\r', '\n')
    text = re.sub(r'^\n+', '', text)

    return text