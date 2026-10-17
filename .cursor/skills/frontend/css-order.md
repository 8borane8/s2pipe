# CSS property order

Always group in this order. Blank lines between groups are optional. When you open a flex or grid context, declare the
useful values even if they are defaults (`flex-direction: row`, `flex-wrap: nowrap`, and so on).

## 1. Box / dimensions

```
width
min-width
max-width
height
min-height
max-height
aspect-ratio
box-sizing
```

## 2. Typography / text color

```
color
font-family
font-size
font-weight
font-style
font-variant
line-height
letter-spacing
word-spacing
```

## 3. Text

```
text-align
text-transform
text-decoration
text-overflow
text-indent
white-space
word-break
overflow-wrap
hyphens
vertical-align
list-style
```

## 4. Display and layout (flex or grid)

```
display
flex-direction
flex-wrap
flex-flow
justify-content
align-items
align-content
align-self
justify-self
flex
flex-grow
flex-shrink
flex-basis
order
gap
row-gap
column-gap
grid
grid-template
grid-template-columns
grid-template-rows
grid-template-areas
grid-auto-flow
grid-auto-columns
grid-auto-rows
grid-column
grid-row
grid-area
place-items
place-content
place-self
```

Rules:

- Flex by default. If `display: flex`, declare at least: `flex-direction`, `justify-content`, `align-items`,
  `flex-wrap`, and `gap` when they matter.
- Grid only when it is clearly better than flex. If `display: grid`, declare tracks and gaps explicitly.

## 5. Spacing

```
margin
margin-block
margin-inline
margin-top
margin-right
margin-bottom
margin-left
padding
padding-block
padding-inline
padding-top
padding-right
padding-bottom
padding-left
```

## 6. Positioning and overflow

```
position
inset
top
right
bottom
left
z-index
overflow
overflow-x
overflow-y
isolation
```

## 7. Background and borders

```
background
background-color
background-image
background-size
background-position
background-repeat
background-clip
border
border-width
border-style
border-color
border-top
border-right
border-bottom
border-left
border-radius
outline
outline-offset
box-shadow
opacity
visibility
```

## 8. Interaction and effects

```
cursor
pointer-events
user-select
resize
appearance
filter
backdrop-filter
transform
transform-origin
transition
transition-property
transition-duration
transition-timing-function
transition-delay
animation
animation-name
animation-duration
animation-timing-function
animation-delay
animation-iteration-count
animation-direction
animation-fill-mode
will-change
object-fit
object-position
```

## Full example

```css
.card {
	width: 100%;
	max-width: 24rem;
	height: auto;
	min-height: 0;

	color: var(--color-text);
	font-family: var(--font-sans);
	font-size: var(--text-md);
	font-weight: 400;
	line-height: 1.5;

	text-align: left;
	text-transform: none;

	display: flex;
	flex-direction: column;
	justify-content: flex-start;
	align-items: stretch;
	flex-wrap: nowrap;
	gap: var(--space-4);

	margin: 0;
	padding: var(--space-5);

	overflow: hidden;

	background: var(--color-bg-elevated);
	border: 1px solid var(--color-border);
	border-radius: var(--radius-md);
	box-shadow: var(--shadow-sm);

	cursor: default;
	transition: box-shadow var(--ease);
}
```

## Avoid

- `float` (except an isolated legacy case)
- Chains of `position: absolute` for a layout that flex or grid would handle
- Utility classes sprinkled on every child
- Properties out of this order (keep the same arrangement everywhere)
