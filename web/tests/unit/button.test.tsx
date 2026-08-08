import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '../../src/components/ui/button';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>点我</Button>);
    expect(screen.getByRole('button', { name: '点我' })).toBeInTheDocument();
  });
  it('applies variant class', () => {
    render(<Button variant="destructive">del</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-danger');
  });
});
