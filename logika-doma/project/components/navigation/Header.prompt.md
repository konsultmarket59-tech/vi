Top site header. Always pass logoSrc pointing at the copied assets/logo-horizontal.svg.
```jsx
<Header logoSrc="assets/logo-horizontal.svg" active="Проекты" onNavigate={go}/>
<Header variant="mobile" logoSrc="assets/logo-horizontal.svg"/>
```
Active nav item: navy semibold + 2px cyan underline. Also exports Wordmark (inverse for navy backgrounds).