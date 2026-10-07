// Wires a "Show password" checkbox to one or more password inputs.
export function wirePasswordToggle(checkbox, inputs) {
  checkbox.addEventListener('change', () => {
    for (const input of inputs) input.type = checkbox.checked ? 'text' : 'password';
  });
}
