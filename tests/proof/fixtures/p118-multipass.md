# Multi-pass references

The estimate in equation \eqref{eq:later} controls the lattice growth rate, a bound first established by \cite{DM19}.

Some intervening prose so the labelled equation appears strictly LATER in the document than the forward reference above.
A single LaTeX pass therefore cannot know the equation's number when it typesets that earlier reference, leaving it unresolved until a second pass reads the auxiliary data from the first.

\begin{equation}\label{eq:later} \zeta(2) = \frac{\pi^2}{6} \end{equation}

\bibliographystyle{plain} \bibliography{references}
