import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'getting-started',
    {
      type: 'category',
      label: 'Guides',
      items: [
        'guides/installation',
        'guides/remote-access',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        'reference/cli-options',
        'reference/sessions',
        'reference/shells',
        'reference/profiles',
        'reference/themes',
        'reference/fonts',
        {
          type: 'category',
          label: 'Soft Keys',
          link: { type: 'doc', id: 'reference/softkeys/index' },
          items: [
            'reference/softkeys/modifier-and-special-keys',
            'reference/softkeys/input-control',
            'reference/softkeys/system-meter',
            'reference/softkeys/custom-keys',
            'reference/softkeys/containers',
          ],
        },
        'reference/keyboard-shortcuts',
        'reference/gestures',
        'reference/clipboard',
        'reference/remote-editor',
        'reference/notifications',
        'reference/adaptive-protocol',
      ],
    },
    'license',
  ],
};

export default sidebars;
